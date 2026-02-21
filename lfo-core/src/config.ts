export interface Config {
  port: number;
  host: string;
  android: { host: string; port: number; timeout: number };
  gemini: { apiKey: string; model: string; timeout: number };
  routing: { maxLocalTokens: number };
  auth: { token: string | undefined };
}

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (!value && defaultValue === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value || defaultValue!;
}

export const CONFIG: Config = {
  port: parseInt(getEnv("PORT", "8080"), 10),
  host: getEnv("HOST", "0.0.0.0"),
  android: {
    host: getEnv("ANDROID_HOST", "127.0.0.1"),
    port: parseInt(getEnv("ANDROID_PORT", "5555"), 10),
    timeout: 30000
  },
  gemini: {
    apiKey: getEnv("GEMINI_API_KEY"),
    model: getEnv("GEMINI_MODEL", "gemini-2.0-flash"),
    timeout: 60000
  },
  routing: {
    maxLocalTokens: parseInt(getEnv("MAX_LOCAL_TOKENS", "1500"), 10)
  },
  auth: {
    token: process.env["LFO_AUTH_TOKEN"] || undefined
  }
};
