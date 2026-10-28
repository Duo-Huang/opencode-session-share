import { render } from "solid-js/web"
import "./style.css"
import { App } from "./App"
import { applyTheme, loadThemeMode } from "./theme"

applyTheme(loadThemeMode())

render(() => <App />, document.getElementById("root")!)
