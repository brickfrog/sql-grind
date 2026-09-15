import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import { registerServiceWorker } from "./lib/service-worker";
mount(App, { target: document.getElementById("app")! });
// Keeps the engine payload in Cache Storage for offline use. No-op in dev.
registerServiceWorker();
