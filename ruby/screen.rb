require "json"
require "net/http"
require "uri"

begin
  api_key = ENV["SANCTIONSKIT_API_KEY"]
  request_key = ENV["REQUEST_KEY"]
  base_url = ENV["SANCTIONSKIT_BASE_URL"] || "https://www.sanctionskit.com/api/v1"
  if api_key.nil? || api_key.empty? || request_key.nil? || request_key.empty?
    abort "Set SANCTIONSKIT_API_KEY and REQUEST_KEY."
  end

  uri = URI("#{base_url.sub(%r{/+$}, '')}/screenings")
  request = Net::HTTP::Post.new(uri)
  request["Authorization"] = "Bearer #{api_key}"
  request["Content-Type"] = "application/json"
  request["Idempotency-Key"] = request_key
  request.body = JSON.generate({
    subject: { name: "Alex Morgan", entityType: "person", birthDate: "1984" },
    package: "sandbox@1",
    reference: "example-customer-001",
    retention: "standard"
  })

  response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https",
                            open_timeout: 30, read_timeout: 30, write_timeout: 30) do |http|
    http.request(request)
  end
  unless response.is_a?(Net::HTTPSuccess)
    abort "HTTP #{response.code}\n#{response.body}"
  end
  puts response.body
rescue StandardError => error
  warn error.message
  exit 1
end
