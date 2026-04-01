package main

import (
	"crypto/tls"
	"encoding/json"
	"flag"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/acore2026/go-upf/internal/adaptiveqos/client"
	"gopkg.in/yaml.v3"
)

type Config struct {
	ProxyTemplate      string `yaml:"proxyTemplate"`
	UpfAddr            string `yaml:"upfAddr"`
	TargetHost         string `yaml:"targetHost"`
	TargetPort         int    `yaml:"targetPort"`
	ServerName         string `yaml:"serverName"`
	InsecureSkipVerify bool   `yaml:"insecureSkipVerify"`
	Listen             string `yaml:"listen"`
	HTTP               struct {
		ListenAddress string `yaml:"listenAddress"`
	} `yaml:"http"`
}

type app struct {
	cfg    Config
	client *client.Client

	mu    sync.RWMutex
	trace []client.AdaptiveFeedback
	flows map[string]*client.AdaptiveFeedback
}

func main() {
	var configPath string
	flag.StringVar(&configPath, "config", "./config/adaptive-qos-sidecar.yaml", "path to config file")
	flag.Parse()

	f, err := os.Open(configPath)
	if err != nil {
		log.Fatalf("open config: %v", err)
	}
	defer f.Close()

	var cfg Config
	if err := yaml.NewDecoder(f).Decode(&cfg); err != nil {
		log.Fatalf("decode config: %v", err)
	}

	if cfg.Listen == "" {
		cfg.Listen = cfg.HTTP.ListenAddress
	}
	if cfg.Listen == "" {
		cfg.Listen = "0.0.0.0:18080"
	}

	proxyTemplate := cfg.ProxyTemplate
	if proxyTemplate == "" {
		proxyTemplate = cfg.UpfAddr
	}

	a := &app{
		cfg: cfg,
		client: &client.Client{
			ProxyTemplate: proxyTemplate,
			UpfAddr:       cfg.UpfAddr,
			TargetHost:    cfg.TargetHost,
			TargetPort:    cfg.TargetPort,
			TLSConf: &tls.Config{
				InsecureSkipVerify: cfg.InsecureSkipVerify,
				ServerName:         cfg.ServerName,
			},
		},
		flows: make(map[string]*client.AdaptiveFeedback),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/reset", a.handleReset)
	mux.HandleFunc("/status", a.handleStatus)
	mux.HandleFunc("/trace", a.handleTrace)
	mux.HandleFunc("/demo/story1/start", a.handleStory1Start)
	mux.HandleFunc("/flows/", a.handleFlowDetail)

	log.Printf("Starting sidecar on %s, proxy=%s target=%s:%d", cfg.Listen, proxyTemplate, cfg.TargetHost, cfg.TargetPort)
	if err := http.ListenAndServe(cfg.Listen, mux); err != nil {
		log.Fatal(err)
	}
}

func (a *app) handleStatus(w http.ResponseWriter, r *http.Request) {
	a.mu.RLock()
	defer a.mu.RUnlock()

	resp := map[string]any{
		"activeFlows": len(a.flows),
		"traceDepth":  len(a.trace),
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func (a *app) handleReset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	a.mu.Lock()
	a.trace = nil
	a.flows = make(map[string]*client.AdaptiveFeedback)
	a.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":      "reset",
		"generatedAt": time.Now().UTC(),
	})
}

func (a *app) handleTrace(w http.ResponseWriter, r *http.Request) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(a.trace)
}

func (a *app) handleStory1Start(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req client.AdaptiveReport
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.ReportType == "" {
		req.ReportType = client.AdaptiveReportTypeIntent
	}
	if req.Scenario == "" {
		req.Scenario = "predictive-burst"
	}
	if req.FlowID == "" {
		req.FlowID = "flow-" + time.Now().Format("150405")
	}

	feedback, err := a.client.Report(r.Context(), req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	a.mu.Lock()
	a.trace = append(a.trace, *feedback)
	a.flows[feedback.FlowID] = feedback
	a.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(feedback)
}

func (a *app) handleFlowDetail(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Path[len("/flows/"):]
	a.mu.RLock()
	flow, ok := a.flows[id]
	a.mu.RUnlock()

	if !ok {
		http.Error(w, "flow not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"flowId":       id,
		"active":       true,
		"lastFeedback": flow,
	})
}
