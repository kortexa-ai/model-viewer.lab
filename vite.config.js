import path from "node:path";
import { fileURLToPath } from "node:url";
import mkcert from "vite-plugin-mkcert";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nodeEnv = process.env.NODE_ENV ?? "development";
const envFiles = [
    `.env.${nodeEnv}.local`,
    `.env.${nodeEnv}`,
    ".env.local",
    ".env",
];

for (const file of envFiles) {
    dotenv.config({ path: file, override: true, quiet: true });
}

export default defineConfig({
    base: "/model-viewer/",
    plugins: [mkcert(), react(), tailwindcss()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        host: "0.0.0.0",
        https: true,
        port: Number.parseInt(
            process.env.VITE_DEVSERVER_PORT ??
                process.env.VITE_PREVIEW_PORT ??
                "8000",
            10
        ),
        open: true,
    },
    preview: {
        host: "0.0.0.0",
        https: true,
        port: Number.parseInt(
            process.env.VITE_PREVIEW_PORT ??
                process.env.VITE_DEVSERVER_PORT ??
                "8000",
            10
        ),
        open: true,
    },
    build: {
        outDir: "./dist",
        chunkSizeWarningLimit: 2500,
        rollupOptions: {
            external: [],
            output: {
                manualChunks: {
                    "react-vendor": ["react", "react-dom", "react/jsx-runtime"],
                    "three-core": ["three"],
                    "ui-libs": [
                        "class-variance-authority",
                        "tailwind-merge",
                        "clsx",
                        "lucide-react",
                    ],
                },
            },
        },
    },
});
