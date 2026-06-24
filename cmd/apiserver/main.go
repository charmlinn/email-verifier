package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/julienschmidt/httprouter"

	emailVerifier "github.com/AfterShip/email-verifier"
)

type apiError struct {
	Error string `json:"error"`
}

var verifier = emailVerifier.NewVerifier()

func writeJSON(w http.ResponseWriter, statusCode int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("write response failed: %v", err)
	}
}

func GetEmailVerification(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	ret, err := verifier.Verify(ps.ByName("email"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	if !ret.Syntax.Valid {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "email address syntax is invalid"})
		return
	}

	writeJSON(w, http.StatusOK, ret)
}

func GetHealth(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func main() {
	router := httprouter.New()

	router.GET("/healthz", GetHealth)
	router.GET("/v1/:email/verification", GetEmailVerification)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	server := &http.Server{
		Addr:         fmt.Sprintf(":%s", port),
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	log.Printf("email verifier API listening on %s", server.Addr)
	log.Fatal(server.ListenAndServe())
}
