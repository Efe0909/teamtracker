import { currentSurface } from "./api/session";
import { Entry } from "./surfaces/welcome/Entry";
import { UnderConstruction } from "./UnderConstruction";
import { Welcome } from "./surfaces/welcome/Welcome";

export function App() {
  const surface = currentSurface();
  switch (surface) {
    case "welcome":
      return location.pathname === "/welcome" ? <Welcome /> : <Entry />;
    case "app":
    case "dashboard":
      return <UnderConstruction surface={surface} />;
  }
}
