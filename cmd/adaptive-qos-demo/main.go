package main

import (
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

//go:embed static/*
var staticFiles embed.FS

//go:embed webapp/dist/*
var webappFiles embed.FS

type app struct {
	sidecarBase *url.URL
	upfBase     *url.URL
	sidecarBin  string
	sidecarCfg  string
	client      *http.Client
	static      http.Handler
	staticFS    fs.FS
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

	staticRoot, err := fs.Sub(staticFiles, "static")
	if err != nil {
		panic(fmt.Errorf("load static files: %w", err))
	}

	webappRoot, err := fs.Sub(webappFiles, "webapp/dist")
	if err != nil {
		// It's okay if webapp is not built yet during development
		fmt.Printf("Warning: webapp/dist not found, webapp route will be empty: %v\n", err)
		webappRoot = os.DirFS(".") // dummy
	}

	a := &app{
		sidecarBase: sidecarURL,
		upfBase:     upfURL,
		sidecarBin:  getenvDefault("SIDECAR_BIN", "./adaptive-qos-sidecar"),
		sidecarCfg:  getenvDefault("SIDECAR_CONFIG", "./config/adaptive-qos-sidecar.yaml"),
		client: &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				Proxy: nil,
			},
		},
		static:   http.FileServer(http.FS(staticRoot)),
		staticFS: staticRoot,
		webapp:   http.FileServer(http.FS(webappRoot)),
		webappFS: webappRoot,
	}

	server := &http.Server{
		Addr:              listenAddr,
		Handler:           a.routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	fmt.Printf("Starting adaptive-qos-demo on %s\n", listenAddr)
	fmt.Printf("Static UI: http://%s/\n", listenAddr)
	fmt.Printf("React Webapp: http://%s/webapp/\n", listenAddr)

	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		panic(err)
	}
}

func (a *app) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/reset", a.handleReset)
	mux.HandleFunc("/api/sidecar/", a.handleSidecarProxy)
	mux.HandleFunc("/api/upf/", a.handleUPFProxy)
	mux.HandleFunc("/webapp/", a.handleWebapp)
	mux.HandleFunc("/", a.handleStatic)
	return mux
}

func (a *app) handleStatic(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/" {
		b, err := fs.ReadFile(a.staticFS, "index.html")
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(b)
		return
	}
	a.static.ServeHTTP(w, r)
}

func (a *app) handleWebapp(w http.ResponseWriter, r *http.Request) {
	// If path is exactly /webapp, redirect to /webapp/
	if r.URL.Path == "/webapp" {
		http.Redirect(w, r, "/webapp/", http.StatusMovedPermanently)
		return
	}

	// Serve the index.html for any path under /webapp/ to support client-side routing
	// But first check if the file exists
	relPath := strings.TrimPrefix(r.URL.Path, "/webapp/")
	if relPath == "" {
		relPath = "index.html"
	}

	_, err := fs.Stat(a.webappFS, relPath)
	if err != nil {
		// If file not found, serve index.html (fallback for SPA)
		b, err := fs.ReadFile(a.webappFS, "index.html")
		if err != nil {
			http.Error(w, "Webapp index.html not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(b)
		return
	}

	http.StripPrefix("/webapp/", a.webapp).ServeHTTP(w, r)
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

	if err := a.restartSidecar(r.Context()); err != nil {
		resp["sidecar"] = map[string]any{"status": "error", "error": err.Error()}
	} else {
		resp["sidecar"] = map[string]any{"status": "restarted"}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func (a *app) proxy(w http.ResponseWriter, r *http.Request, base *url.URL, prefix string) {
	target := *base
	target.Path = singleJoiningSlash(base.Path, strings.TrimPrefix(r.URL.Path, prefix))
	target.RawQuery = r.URL.RawQuery

	req, err := http.NewRequestWithContext(r.Context(), r.Method, target.String(), r.Body)
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

func (a *app) callJSON(ctx context.Context, base *url.URL, rawPath, method string) error {
	target := *base
	target.Path = singleJoiningSlash(base.Path, strings.TrimPrefix(rawPath, "/"))
	req, err := http.NewRequestWithContext(ctx, method, target.String(), nil)
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

	_ = exec.CommandContext(ctx, "pkill", "-TERM", "-f", a.sidecarBin).Run()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if err := a.callJSON(ctx, a.sidecarBase, "/status", http.MethodGet); err != nil {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	_ = exec.CommandContext(ctx, "pkill", "-KILL", "-f", a.sidecarBin).Run()
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if err := a.callJSON(ctx, a.sidecarBase, "/status", http.MethodGet); err != nil {
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
		if err := a.callJSON(ctx, a.sidecarBase, "/status", http.MethodGet); err == nil {
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
