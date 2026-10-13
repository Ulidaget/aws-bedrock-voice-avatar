/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WSS_ENDPOINT?: string;
  readonly VITE_AUTH_DISABLED?: string;
  readonly VITE_COGNITO_USER_POOL_ID?: string;
  readonly VITE_COGNITO_CLIENT_ID?: string;
  readonly VITE_COGNITO_DOMAIN?: string;
  readonly VITE_COGNITO_REDIRECT_URI?: string;
  readonly VITE_AVATAR_MODEL_URL?: string;
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
