const icon = new URL("../../assets/icon.svg", import.meta.url).href;

export default function BrandMark({ large = false }: { large?: boolean }) {
  return <img className={`brand-mark${large ? " large" : ""}`} src={icon} alt="知屿" />;
}
