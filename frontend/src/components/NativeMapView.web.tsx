// Web stub: react-native-maps doesn't bundle on web.
// MapView.tsx already uses Platform.OS check, but Metro still bundles the import statement.
// This stub satisfies the import on web — it should never actually render because
// the parent MapView.tsx routes web → SvgMapView before reaching this file.
import SvgMapView from "./SvgMapView";
export default SvgMapView;
