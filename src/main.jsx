import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import RouteMaxApp from "./app.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <RouteMaxApp />
  </StrictMode>
);
