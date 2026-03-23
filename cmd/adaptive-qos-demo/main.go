package main

import (
	"embed"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"
)

//go:embed static/*
var staticFiles embed.FS

type app struct {
	sidecarBase *url.URL
	upfBase     *url.URL
	client      *http.Client
	static      http.Handler
	staticFS    fs.FS
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

	a := &app{
		sidecarBase: sidecarURL,
		upfBase:     upfURL,
		client: &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				Proxy: nil,
			},
		},
		static:   http.FileServer(http.FS(staticRoot)),
		staticFS: staticRoot,
	}

	server := &http.Server{
		Addr:              listenAddr,
		Handler:           a.routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		panic(err)
	}
}

func (a *app) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/sidecar/", a.handleSidecarProxy)
	mux.HandleFunc("/api/upf/", a.handleUPFProxy)
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

func (a *app) handleSidecarProxy(w http.ResponseWriter, r *http.Request) {
	a.proxy(w, r, a.sidecarBase, "/api/sidecar")
}

func (a *app) handleUPFProxy(w http.ResponseWriter, r *http.Request) {
	a.proxy(w, r, a.upfBase, "/api/upf")
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
