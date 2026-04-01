package main

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"strings"
	"sync"
	"time"
)

//go:embed qos/dist/*
var demoFiles embed.FS

//go:embed qos-graph-lab/dist/*
var graphLabFiles embed.FS

type app struct {
	sidecarBase *url.URL
	upfBase     *url.URL
	sidecarBin  string
	sidecarCfg  string
	webappPath  string
	client      *http.Client
	demo        http.Handler
	demoFS      fs.FS
	graphLab    http.Handler
	graphLabFS  fs.FS
	webapp      http.Handler
	webappFS    fs.FS
	resetMu     sync.Mutex
}

func main() {
	var (
		listenAddr  string
		sidecarBase string
		upfBase     string
	)
	flag.StringVar(&listenAddr, "listen", "127.0.0.1:8088", "HTTP listen address")
	flag.StringVar(&sidecarBase, "sidecar-base", "http://127.0.0.1:18080", "sidecar base URL")
	flag.StringVar(&upfBase, "upf-base", "http://127.0.0.1:9082", "UPF debug base URL")
	flag.Parse()

	sidecarURL, err := url.Parse(sidecarBase)
	if err != nil {
		panic(fmt.Errorf("parse sidecar base: %w", err))
	}
	upfURL, err := url.Parse(upfBase)
	if err != nil {
		panic(fmt.Errorf("parse upf base: %w", err))
	}

	demoRoot, err := fs.Sub(demoFiles, "qos/dist")
	if err != nil {
		// It's okay if qos/dist is not built yet during development
		fmt.Printf("Warning: qos/dist not found, demo route will be empty: %v\n", err)
		demoRoot = os.DirFS(".") // dummy
	}

	graphLabRoot, err := fs.Sub(graphLabFiles, "qos-graph-lab/dist")
	if err != nil {
		// It's okay if qos-graph-lab/dist is not built yet during development
		fmt.Printf("Warning: qos-graph-lab/dist not found, graph lab route will be empty: %v\n", err)
		graphLabRoot = os.DirFS(".") // dummy
	}

	webappPath := getenvDefault("WEBAPP_DIST", "adaptive-qos-video-stream/webapp/dist")
	webappRoot := os.DirFS(webappPath)
	if _, err := fs.Stat(webappRoot, "index.html"); err != nil {
		fmt.Printf("Warning: %s/index.html not found, webapp route will be empty: %v\n", webappPath, err)
		webappRoot = os.DirFS(".") // dummy
	}

	a := &app{
		sidecarBase: sidecarURL,
		upfBase:     upfURL,
		sidecarBin:  getenvDefault("SIDECAR_BIN", "./adaptive-qos-sidecar"),
		sidecarCfg:  getenvDefault("SIDECAR_CONFIG", "./config/adaptive-qos-sidecar.yaml"),
		webappPath:  webappPath,
		client: &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				Proxy: nil,
			},
		},
		demo:       http.FileServer(http.FS(demoRoot)),
		demoFS:     demoRoot,
		graphLab:   http.FileServer(http.FS(graphLabRoot)),
		graphLabFS: graphLabRoot,
		webapp:     http.FileServer(http.FS(webappRoot)),
		webappFS:   webappRoot,
	}

	server := &http.Server{
		Addr:              listenAddr,
		Handler:           a.routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	fmt.Printf("Starting adaptive-qos-demo on %s\n", listenAddr)
	fmt.Printf("Demo UI: http://%s/\n", listenAddr)
	fmt.Printf("Graph Lab: http://%s/qos/\n", listenAddr)
	fmt.Printf("Video Webapp: http://%s/webapp/ (dist: %s)\n", listenAddr, webappPath)

	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		panic(err)
	}
}

func (a *app) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/reset", a.handleReset)
	mux.HandleFunc("/api/sidecar/", a.handleSidecarProxy)
	mux.HandleFunc("/api/upf/", a.handleUPFProxy)
	mux.HandleFunc("/webapp", a.handleWebappAlias)
	mux.HandleFunc("/webapp/", a.handleWebappAlias)
	mux.HandleFunc("/qos", a.handleGraphLabAlias)
	mux.HandleFunc("/qos/", a.handleGraphLabAlias)
	mux.HandleFunc("/qos-graph-lab", a.handleGraphLabAlias)
	mux.HandleFunc("/qos-graph-lab/", a.handleGraphLabAlias)
	mux.HandleFunc("/", a.handleDemoRoot)
	return mux
}

func (a *app) handleDemoRoot(w http.ResponseWriter, r *http.Request) {
	a.serveStaticApp(w, r, "", a.demo, a.demoFS, "Demo index.html not found")
}

func (a *app) handleGraphLabAlias(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/qos" || r.URL.Path == "/qos-graph-lab" {
		http.Redirect(w, r, "/qos/", http.StatusMovedPermanently)
		return
	}
	a.serveStaticApp(w, r, "/qos", a.graphLab, a.graphLabFS, "Graph lab index.html not found")
}

func (a *app) handleWebappAlias(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/webapp" {
		http.Redirect(w, r, "/webapp/", http.StatusMovedPermanently)
		return
	}
	a.serveStaticApp(w, r, "/webapp", a.webapp, a.webappFS, "Webapp index.html not found")
}

func (a *app) serveStaticApp(w http.ResponseWriter, r *http.Request, prefix string, handler http.Handler, root fs.FS, notFoundMsg string) {
	relPath := strings.TrimPrefix(r.URL.Path, prefix)
	relPath = strings.TrimPrefix(relPath, "/")
	if relPath == "" {
		relPath = "index.html"
	}

	_, err := fs.Stat(root, relPath)
	if err != nil {
		b, err := fs.ReadFile(root, "index.html")
		if err != nil {
			http.Error(w, notFoundMsg, http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(b)
		return
	}

	if prefix == "" {
		http.StripPrefix("/", handler).ServeHTTP(w, r)
		return
	}
	http.StripPrefix(prefix+"/", handler).ServeHTTP(w, r)
}

func (a *app) handleSidecarProxy(w http.ResponseWriter, r *http.Request) {
	a.proxy(w, r, a.sidecarBase, "/api/sidecar")
}

func (a *app) handleUPFProxy(w http.ResponseWriter, r *http.Request) {
	a.proxy(w, r, a.upfBase, "/api/upf")
}

func (a *app) handleReset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	a.resetMu.Lock()
	defer a.resetMu.Unlock()

	resp := map[string]any{
		"generatedAt": time.Now().UTC(),
		"upf":         map[string]any{"status": "skipped"},
		"sidecar":     map[string]any{"status": "skipped"},
	}

	if err := a.callJSON(r.Context(), a.upfBase, "/debug/adaptive-qos/reset", http.MethodPost); err != nil {
		resp["upf"] = map[string]any{"status": "error", "error": err.Error()}
	} else {
		resp["upf"] = map[string]any{"status": "reset"}
	}

	if err := a.callJSON(r.Context(), a.sidecarBase, "/reset", http.MethodPost); err != nil {
		if fallbackErr := a.restartSidecar(r.Context()); fallbackErr != nil {
			resp["sidecar"] = map[string]any{
				"status": "error",
				"error":  fmt.Sprintf("reset endpoint failed: %v; local restart failed: %v", err, fallbackErr),
			}
		} else {
			resp["sidecar"] = map[string]any{
				"status": "restarted",
				"note":   fmt.Sprintf("sidecar reset endpoint unavailable, used local restart: %v", err),
			}
		}
	} else {
		resp["sidecar"] = map[string]any{"status": "reset"}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func (a *app) proxy(w http.ResponseWriter, r *http.Request, base *url.URL, prefix string) {
	target := *base
	target.Path = singleJoiningSlash(base.Path, strings.TrimPrefix(r.URL.Path, prefix))
	target.RawQuery = r.URL.RawQuery

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer r.Body.Close()
	if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/demo/story1/start") {
		body = augmentStory1RequestBody(body)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, r.Method, target.String(), bytes.NewReader(body))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	copyHeaders(req.Header, r.Header)
	req.Host = target.Host

	resp, err := a.client.Do(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	copyHeaders(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func augmentStory1RequestBody(body []byte) []byte {
	var req map[string]any
	if err := json.Unmarshal(body, &req); err != nil {
		return body
	}
	if req == nil {
		return body
	}
	if _, ok := req["packet"]; !ok {
		srcIP := stringValue(req["ueAddress"], "10.60.0.1")
		req["packet"] = map[string]any{
			"srcIp":    srcIP,
			"dstIp":    "198.51.100.10",
			"srcPort":  40000,
			"dstPort":  9999,
			"protocol": "udp",
		}
	}
	if _, ok := req["flowDescription"]; !ok {
		req["flowDescription"] = "permit out udp from 10.60.0.1 40000 to 198.51.100.10 9999"
	}
	out, err := json.Marshal(req)
	if err != nil {
		return body
	}
	return out
}

func stringValue(v any, fallback string) string {
	if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
		return s
	}
	return fallback
}

func (a *app) callJSON(ctx context.Context, base *url.URL, rawPath, method string) error {
	target := *base
	target.Path = singleJoiningSlash(base.Path, strings.TrimPrefix(rawPath, "/"))
	if ctx == nil {
		ctx = context.Background()
	}
	callCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(callCtx, method, target.String(), nil)
	if err != nil {
		return err
	}
	req.Host = target.Host
	resp, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		if len(body) == 0 {
			return fmt.Errorf("%s %s returned %s", method, target.String(), resp.Status)
		}
		return fmt.Errorf("%s %s returned %s: %s", method, target.String(), resp.Status, strings.TrimSpace(string(body)))
	}
	return nil
}

func (a *app) restartSidecar(ctx context.Context) error {
	if strings.TrimSpace(a.sidecarBin) == "" || strings.TrimSpace(a.sidecarCfg) == "" {
		return fmt.Errorf("sidecar reset configuration missing")
	}

	killCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = exec.CommandContext(killCtx, "pkill", "-TERM", "-f", a.sidecarBin).Run()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if err := a.callJSON(context.Background(), a.sidecarBase, "/status", http.MethodGet); err != nil {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	_ = exec.CommandContext(killCtx, "pkill", "-KILL", "-f", a.sidecarBin).Run()
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if err := a.callJSON(context.Background(), a.sidecarBase, "/status", http.MethodGet); err != nil {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	startCmd := fmt.Sprintf("cd /ueransim && nohup %q -config %q >/tmp/adaptive-qos-sidecar-reset.log 2>&1 &", a.sidecarBin, a.sidecarCfg)
	if err := exec.Command("sh", "-lc", startCmd).Run(); err != nil {
		return fmt.Errorf("restart sidecar: %w", err)
	}

	deadline = time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if err := a.callJSON(context.Background(), a.sidecarBase, "/status", http.MethodGet); err == nil {
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	return fmt.Errorf("sidecar did not become ready after restart")
}

func getenvDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func copyHeaders(dst, src http.Header) {
	for key, values := range src {
		dst.Del(key)
		for _, value := range values {
			dst.Add(key, value)
		}
	}
}

func singleJoiningSlash(basePath, requestPath string) string {
	if requestPath == "" {
		return basePath
	}
	if basePath == "" {
		return path.Clean("/" + requestPath)
	}
	return path.Clean(strings.TrimRight(basePath, "/") + "/" + strings.TrimLeft(requestPath, "/"))
}
