DELETE FROM "jwks"
WHERE COALESCE(json_extract("publicKey", '$.kty'), '') <> 'RSA';
