#!/bin/bash

set -e

SECRET_NAME="LivekitSSLCertArn"

read -p "Enter AWS region (press Enter to use your configured default): " REGION
if [ -z "$REGION" ]; then
  REGION=$(aws configure get region)
  echo "Using configured default region: $REGION"
else
  echo "Using region: $REGION"
fi

CERT_FILE="cert.pem"
KEY_FILE="key.pem"

echo "Generating self-signed certificate..."
openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout "$KEY_FILE" \
  -out "$CERT_FILE" \
  -subj "/C=US/ST=California/L=Localhost/O=MyOrg/CN=localhost" \
  > /dev/null

echo
echo "Preview cert:"
cat "$CERT_FILE"
echo
echo "Preview key:"
cat "$KEY_FILE"
echo

echo "Uploading certificate to ACM..."
CERT_ARN=$(aws acm import-certificate \
  --certificate fileb://$CERT_FILE \
  --private-key fileb://$KEY_FILE \
  --region "$REGION" \
  --query CertificateArn \
  --output text 2>/dev/null || true)

if [ -z "$CERT_ARN" ] || [ "$CERT_ARN" == "None" ]; then
  echo "❌ No certificate ARN returned. Aborting."
  exit 1
fi

echo "✅ ACM certificate uploaded: $CERT_ARN"

echo "Storing certificate ARN in Secrets Manager..."

# Try to create, else update
if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws secretsmanager put-secret-value \
    --secret-id "$SECRET_NAME" \
    --secret-string "$CERT_ARN" \
    --region "$REGION"
  echo "✅ Secret updated: $SECRET_NAME"
else
  aws secretsmanager create-secret \
    --name "$SECRET_NAME" \
    --secret-string "$CERT_ARN" \
    --region "$REGION"
  echo "✅ Secret created: $SECRET_NAME"
fi
