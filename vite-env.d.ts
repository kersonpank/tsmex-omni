/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly GEMINI_API_KEY: string
    readonly PROD: boolean
    readonly DEV: boolean
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
