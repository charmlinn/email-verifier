package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/julienschmidt/httprouter"

	emailVerifier "github.com/AfterShip/email-verifier"
)

type apiError struct {
	Error string `json:"error"`
}

type apiErrorWithResult struct {
	Error  string                `json:"error"`
	Result *emailVerifier.Result `json:"result,omitempty"`
}

func writeJSON(w http.ResponseWriter, statusCode int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("write response failed: %v", err)
	}
}

func queryValue(values url.Values, names ...string) string {
	for _, name := range names {
		if value := values.Get(name); value != "" {
			return value
		}
	}
	return ""
}

func boolQuery(values url.Values, defaultValue bool, names ...string) (bool, error) {
	raw := queryValue(values, names...)
	if raw == "" {
		return defaultValue, nil
	}

	switch strings.ToLower(raw) {
	case "1", "t", "true", "y", "yes", "on":
		return true, nil
	case "0", "f", "false", "n", "no", "off":
		return false, nil
	default:
		return strconv.ParseBool(raw)
	}
}

func durationQuery(values url.Values, names ...string) (time.Duration, bool, error) {
	raw := queryValue(values, names...)
	if raw == "" {
		return 0, false, nil
	}

	duration, err := time.ParseDuration(raw)
	if err != nil {
		return 0, true, err
	}
	return duration, true, nil
}

func newVerifierFromQuery(values url.Values) (*emailVerifier.Verifier, error) {
	verifier := emailVerifier.NewVerifier()

	smtpEnabled, err := boolQuery(values, false, "smtp", "enable_smtp")
	if err != nil {
		return nil, fmt.Errorf("invalid smtp value: %w", err)
	}
	if smtpEnabled {
		verifier.EnableSMTPCheck()
	}

	catchAllEnabled, err := boolQuery(values, true, "catchAll", "catch_all", "catchall")
	if err != nil {
		return nil, fmt.Errorf("invalid catch_all value: %w", err)
	}
	if !catchAllEnabled {
		verifier.DisableCatchAllCheck()
	}

	domainSuggestEnabled, err := boolQuery(values, false, "suggest", "domain_suggest")
	if err != nil {
		return nil, fmt.Errorf("invalid suggest value: %w", err)
	}
	if domainSuggestEnabled {
		verifier.EnableDomainSuggest()
	}

	gravatarEnabled, err := boolQuery(values, false, "gravatar", "gravatar_check")
	if err != nil {
		return nil, fmt.Errorf("invalid gravatar value: %w", err)
	}
	if gravatarEnabled {
		verifier.EnableGravatarCheck()
	}

	yahooAPIEnabled, err := boolQuery(values, false, "yahooApi", "yahoo_api")
	if err != nil {
		return nil, fmt.Errorf("invalid yahoo_api value: %w", err)
	}
	if yahooAPIEnabled {
		verifier.EnableSMTPCheck()
		if err := verifier.EnableAPIVerifier(emailVerifier.YAHOO); err != nil {
			return nil, err
		}
	}

	if fromEmail := queryValue(values, "fromEmail", "from_email"); fromEmail != "" {
		verifier.FromEmail(fromEmail)
	}
	if helloName := queryValue(values, "helloName", "hello_name"); helloName != "" {
		verifier.HelloName(helloName)
	}
	if proxy := queryValue(values, "proxy"); proxy != "" {
		verifier.Proxy(proxy)
	}
	if timeout, ok, err := durationQuery(values, "connectTimeout", "connect_timeout"); err != nil {
		return nil, fmt.Errorf("invalid connect_timeout value: %w", err)
	} else if ok {
		verifier.ConnectTimeout(timeout)
	}
	if timeout, ok, err := durationQuery(values, "operationTimeout", "operation_timeout"); err != nil {
		return nil, fmt.Errorf("invalid operation_timeout value: %w", err)
	} else if ok {
		verifier.OperationTimeout(timeout)
	}

	return verifier, nil
}

func GetEmailVerification(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	verifier, err := newVerifierFromQuery(r.URL.Query())
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}

	ret, err := verifier.Verify(ps.ByName("email"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiErrorWithResult{
			Error:  err.Error(),
			Result: ret,
		})
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
