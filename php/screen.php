<?php
declare(strict_types=1);

$apiKey = getenv('SANCTIONSKIT_API_KEY');
$requestKey = getenv('REQUEST_KEY');
if (!$apiKey || !$requestKey) {
    fwrite(STDERR, "Set SANCTIONSKIT_API_KEY and REQUEST_KEY.\n");
    exit(1);
}

$baseUrl = getenv('SANCTIONSKIT_BASE_URL') ?: 'https://www.sanctionskit.com/api/v1';
$body = [
    'subject' => [
        'name' => 'Alex Morgan',
        'entityType' => 'person',
        'birthDate' => '1984',
    ],
    'package' => 'sandbox@1',
    'reference' => 'example-customer-001',
    'retention' => 'standard',
];

$curl = curl_init(rtrim($baseUrl, '/') . '/screenings');
curl_setopt_array($curl, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . $apiKey,
        'Idempotency-Key: ' . $requestKey,
        'Content-Type: application/json',
    ],
    CURLOPT_POSTFIELDS => json_encode($body, JSON_THROW_ON_ERROR),
]);

$response = curl_exec($curl);
$status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
$error = curl_error($curl);
curl_close($curl);

if ($response === false) {
    fwrite(STDERR, "Request failed: $error\n");
    exit(1);
}
if ($status < 200 || $status >= 300) {
    fwrite(STDERR, "HTTP $status\n$response\n");
    exit(1);
}

echo $response, "\n";
