using System.Net.Http.Headers;
using System.Net.Http.Json;

try
{
    string apiKey = RequiredEnv("SANCTIONSKIT_API_KEY");
    string requestKey = RequiredEnv("REQUEST_KEY");
    string baseUrl = Environment.GetEnvironmentVariable("SANCTIONSKIT_BASE_URL")
        ?? "https://www.sanctionskit.com/api/v1";

    using var handler = new HttpClientHandler { AllowAutoRedirect = false };
    using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(30) };
    using var request = new HttpRequestMessage(HttpMethod.Post, baseUrl.TrimEnd('/') + "/screenings");
    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
    request.Headers.Add("Idempotency-Key", requestKey);
    request.Content = JsonContent.Create(new
    {
        subject = new { name = "Alex Morgan", entityType = "person", birthDate = "1984" },
        package = "sandbox@1",
        reference = "example-customer-001",
        retention = "standard"
    });

    using var response = await client.SendAsync(request);
    string body = await response.Content.ReadAsStringAsync();
    if (!response.IsSuccessStatusCode)
    {
        Console.Error.WriteLine($"HTTP {(int)response.StatusCode}: {body}");
        Environment.ExitCode = 1;
        return;
    }
    Console.WriteLine(body);
}
catch (Exception error)
{
    Console.Error.WriteLine(error.Message);
    Environment.ExitCode = 1;
}

static string RequiredEnv(string name)
{
    string? value = Environment.GetEnvironmentVariable(name);
    if (string.IsNullOrWhiteSpace(value))
        throw new ArgumentException($"set {name}");
    return value.Trim();
}
