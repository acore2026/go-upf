package sbi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"sync"
	"time"

	openapimodels "github.com/free5gc/openapi/models"
	"github.com/gin-gonic/gin"

	upf_context "github.com/free5gc/go-upf/internal/context"
	"github.com/free5gc/go-upf/internal/logger"
	"github.com/free5gc/go-upf/internal/pfcp"
	"github.com/free5gc/go-upf/internal/sbi/consumer"
	sbimodels "github.com/free5gc/go-upf/internal/sbi/models"
	"github.com/free5gc/go-upf/internal/sbi/processor"
	"github.com/free5gc/go-upf/pkg/factory"
	logger_util "github.com/free5gc/util/logger"
)

type Service interface {
	Config() *factory.Config
	PFCPServer() *pfcp.PfcpServer
}

type Server struct {
	service    Service
	httpServer *http.Server
	router     *gin.Engine
	processor  *processor.Processor
	nrfService *consumer.NrfService
}

func NewServer(service Service) *Server {
	upf_context.GetSelf().Init(service.Config())

	s := &Server{
		service:    service,
		processor:  processor.New(),
		nrfService: &consumer.NrfService{},
	}
	s.router = s.newRouter()
	s.httpServer = &http.Server{
		Addr:              bindAddr(service.Config()),
		Handler:           s.router,
		ReadHeaderTimeout: 10 * time.Second,
	}
	return s
}

func bindAddr(cfg *factory.Config) string {
	return cfg.Sbi.BindingIPv4 + ":" + strconv.Itoa(cfg.Sbi.Port)
}

func (s *Server) newRouter() *gin.Engine {
	router := logger_util.NewGinWithLogrus(logger.SBILog)
	group := router.Group(factory.UpfEventExposureResURI)
	group.GET("/", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"service": factory.UpfServiceNameEventExposure, "status": "running"})
	})
	group.POST("/subscriptions", s.handleCreateSubscription)
	group.GET("/subscriptions/:subscriptionId", s.handleGetSubscription)
	group.PATCH("/subscriptions/:subscriptionId", s.handleModifySubscription)
	group.DELETE("/subscriptions/:subscriptionId", s.handleDeleteSubscription)
	return router
}

func (s *Server) Run(wg *sync.WaitGroup) {
	wg.Add(1)
	go func() {
		defer wg.Done()
		logger.SBILog.Infof("start SBI server on %s", s.httpServer.Addr)
		var err error
		switch s.service.Config().Sbi.Scheme {
		case "http":
			err = s.httpServer.ListenAndServe()
		case "https":
			err = s.httpServer.ListenAndServeTLS(s.service.Config().GetCertPemPath(), s.service.Config().GetCertKeyPath())
		default:
			err = errors.New("invalid SBI scheme")
		}
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.SBILog.Errorf("SBI server error: %v", err)
		}
	}()

	go func() {
		if err := s.nrfService.RegisterNFInstance(context.Background()); err != nil {
			logger.SBILog.Warnf("NRF registration skipped: %v", err)
		}
	}()
}

func (s *Server) Shutdown() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if err := s.nrfService.DeregisterNFInstance(ctx); err != nil {
		logger.SBILog.Warnf("NRF deregistration failed: %v", err)
	}
	if err := s.httpServer.Shutdown(ctx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.SBILog.Warnf("SBI shutdown failed: %v", err)
	}
}

func (s *Server) handleCreateSubscription(c *gin.Context) {
	var req sbimodels.CreateEventSubscription
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"cause": "INVALID_JSON", "detail": err.Error()})
		return
	}
	rsp, problem := s.processor.CreateSubscription(req)
	respond(c, http.StatusCreated, rsp, problem)
}

func (s *Server) handleGetSubscription(c *gin.Context) {
	rsp, problem := s.processor.GetSubscription(c.Param("subscriptionId"))
	respond(c, http.StatusOK, rsp, problem)
}

func (s *Server) handleModifySubscription(c *gin.Context) {
	var req sbimodels.ModifySubscriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"cause": "INVALID_JSON", "detail": err.Error()})
		return
	}
	rsp, problem := s.processor.ModifySubscription(c.Param("subscriptionId"), req)
	respond(c, http.StatusOK, rsp, problem)
}

func (s *Server) handleDeleteSubscription(c *gin.Context) {
	if problem := s.processor.DeleteSubscription(c.Param("subscriptionId")); problem != nil {
		c.JSON(int(problem.Status), problem)
		return
	}
	c.Status(http.StatusNoContent)
}

func respond(c *gin.Context, code int, payload any, problem *openapimodels.ProblemDetails) {
	if problem != nil {
		c.JSON(int(problem.Status), problem)
		return
	}
	c.JSON(code, payload)
}
