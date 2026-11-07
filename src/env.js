try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {
  // No .env file, or Node without loadEnvFile: rely on the real environment.
}
