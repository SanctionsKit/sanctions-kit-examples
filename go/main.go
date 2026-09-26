package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

func main() {
	if err := screen(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func screen() error {
	apiKey := strings.TrimSpace(os.Getenv("SANCTIONSKIT_API_KEY"))
	requestKey := strings.TrimSpace(os.Getenv("REQUEST_KEY"))
	if apiKey == "" || requestKey == "" {
		return fmt.Errorf("set SANCTIONSKIT_API_KEY and REQUEST_KEY")
	}
	baseURL := os.Getenv("SANCTIONSKIT_BASE_URL")
	if baseURL == "" {
		baseURL = "https://www.sanctionskit.com/api/v1"
	}
	body := `{
		"subject": {"name": "Alex Morgan", "entityType": "person", "birthDate": "1984"},
		"package": "sandbox@1",
		"reference": "example-customer-001",
		"retention": "standard"
	}`
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(baseURL, "/")+"/screenings", strings.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Idempotency-Key", requestKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{
		Timeout: 30 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	responseBody, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d: %s", res.StatusCode, responseBody)
	}
	fmt.Println(string(responseBody))
	return nil
}
