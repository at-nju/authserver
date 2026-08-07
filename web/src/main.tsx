import { render } from "preact";
import Login from "./pages/login";
import Onboarding from "./pages/onboarding";
import Consent from "./pages/consent";
import Console from "./pages/console";
import "./style.css";

function App() {
  document.title = __APP_NAME__;
  switch (location.pathname) {
    case "/login": return <Login />;
    case "/onboarding": return <Onboarding />;
    case "/consent": return <Consent />;
    case "/console": return <Console />;
    default: return null;
  }
}

render(<App />, document.getElementById("app")!);
