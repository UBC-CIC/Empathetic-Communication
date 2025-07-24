param(
    [string]$CertName = "LivekitSSLCert",
    [string]$SecretName = "LivekitSSLCertArn"
)

# Prompt for region
$Region = Read-Host "Enter AWS region (press Enter to use your configured default)"
if (-not $Region) {
    $Region = (aws configure get region)
}
Write-Host "Using region: $Region"

$TempDir = Join-Path $env:TEMP "certgen_$([System.Guid]::NewGuid().ToString())"
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
$KeyFile = Join-Path $TempDir "key.pem"
$CertFile = Join-Path $TempDir "cert.pem"

# Generate self-signed cert
Write-Host "Generating self-signed certificate..."
openssl req -x509 -newkey rsa:2048 -nodes `
    -keyout $KeyFile `
    -out $CertFile `
    -subj "/C=US/ST=CA/L=Localhost/O=MyOrg/CN=localhost" `
    -days 365 | Out-Null

# Preview cert/key
Write-Host "`nPreview cert:"
Get-Content $CertFile
Write-Host "`nPreview key:"
Get-Content $KeyFile

# Upload to ACM
Write-Host "`nUploading certificate to ACM..."
$certArn = aws acm import-certificate `
    --certificate fileb://$CertFile `
    --private-key fileb://$KeyFile `
    --region "$Region" `
    --tags Key=Name,Value=$CertName `
    --query CertificateArn --output text 2>$null

if (-not $certArn -or $certArn -eq "None") {
    Write-Error "❌ No certificate ARN returned. Aborting."
    Remove-Item -Recurse -Force $TempDir
    exit 1
}

Write-Host "`n✅ ACM certificate uploaded:"
Write-Host $certArn

# Store ARN in Secrets Manager
Write-Host "`nStoring certificate ARN in Secrets Manager..."
$secretExists = aws secretsmanager describe-secret `
    --secret-id "$SecretName" `
    --region "$Region" 2>$null

if ($LASTEXITCODE -eq 0) {
    aws secretsmanager update-secret `
        --secret-id "$SecretName" `
        --secret-string "$certArn" `
        --region "$Region" | Out-Null
    Write-Host "✅ Secret updated: $SecretName"
} else {
    aws secretsmanager create-secret `
        --name "$SecretName" `
        --secret-string "$certArn" `
        --region "$Region" | Out-Null
    Write-Host "✅ Secret created: $SecretName"
}

# Cleanup
Remove-Item -Recurse -Force $TempDir
