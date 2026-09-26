import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

public class Screening {
    public static void main(String[] args) {
        try {
            String apiKey = requiredEnv("SANCTIONSKIT_API_KEY");
            String requestKey = requiredEnv("REQUEST_KEY");
            String baseUrl = System.getenv("SANCTIONSKIT_BASE_URL");
            if (baseUrl == null || baseUrl.isBlank()) {
                baseUrl = "https://www.sanctionskit.com/api/v1";
            }
            String body = """
                {
                  "subject": {"name": "Alex Morgan", "entityType": "person", "birthDate": "1984"},
                  "package": "sandbox@1",
                  "reference": "example-customer-001",
                  "retention": "standard"
                }
                """;

            HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(30))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl.replaceAll("/+$", "") + "/screenings"))
                .timeout(Duration.ofSeconds(30))
                .header("Authorization", "Bearer " + apiKey)
                .header("Idempotency-Key", requestKey)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();

            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                System.err.println("HTTP " + response.statusCode() + ": " + response.body());
                System.exit(1);
            }
            System.out.println(response.body());
        } catch (Exception error) {
            System.err.println(error.getMessage());
            System.exit(1);
        }
    }

    private static String requiredEnv(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("set " + name);
        }
        return value.trim();
    }
}
