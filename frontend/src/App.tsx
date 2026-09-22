import { currentSurface } from "./api";
import { UnderConstruction } from "./UnderConstruction";
import { Welcome } from "./Welcome";

export function App() {
  const surface = currentSurface();
  switch (surface) {
    case "welcome":
      return <Welcome />;
    case "app":
    case "dashboard":
      return <UnderConstruction surface={surface} />;
  }
}
