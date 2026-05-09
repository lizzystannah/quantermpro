import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initRobotEngine } from "./lib/robotEngine";

// Initialise the robot engine once at startup — runs independently of any page.
// This ensures robots keep trading even if the user is on the backtest page.
initRobotEngine();

createRoot(document.getElementById("root")!).render(<App />);
