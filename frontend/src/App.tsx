import { currentSurface } from "./api";
import { Entry } from "./Entry";
import { UnderConstruction } from "./UnderConstruction";
import { Welcome } from "./Welcome";

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
