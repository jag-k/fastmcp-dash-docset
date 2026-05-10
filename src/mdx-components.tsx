import { extname } from "node:path";
import { isValidElement, type ComponentType, type CSSProperties, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

export type SearchEntry = {
  name: string;
  type: string;
  path: string;
};

type SdkSection = "Functions" | "Classes";

export type RenderContext = {
  currentPath: string;
  missingMedia: Set<string>;
  onlineBaseUrl: string;
  entries: SearchEntry[];
  anchors: Map<string, number>;
  isSdkPage: boolean;
  sdkSection: SdkSection | null;
  suppressSectionEntries: boolean;
};

type ComponentProps = {
  children?: ReactNode;
  [key: string]: unknown;
};

export function createMdxComponents(context: RenderContext): Record<string, ComponentType<ComponentProps>> {
  return {
    a: ({ href, children }) => <a href={normalizeHref(String(href ?? ""), context)}>{children}</a>,
    Accordion: Expandable,
    AccordionGroup,
    img: ({ src, alt }) => (
      <img src={normalizeHref(String(src ?? ""), context)} alt={String(alt ?? "")} />
    ),
    iframe: (props) => (
      <iframe
        {...iframeProps(props)}
        className="docset-iframe-demo"
        src={normalizeHref(String(props.src ?? ""), context)}
      />
    ),
    h1: headingComponent(1, context),
    h2: headingComponent(2, context),
    h3: headingComponent(3, context),
    h4: headingComponent(4, context),
    h5: headingComponent(5, context),
    h6: headingComponent(6, context),
    Card: (props) => <Card {...props} context={context} />,
    CardGroup,
    CodeGroup,
    Columns: CardGroup,
    Expandable,
    Frame,
    Icon,
    Info: calloutComponent("Info"),
    LocalFocusTip,
    Note: calloutComponent("Note"),
    ParamField: fieldComponent("ParamField", context),
    Prompt,
    PrefabPinWarning,
    ResponseField: fieldComponent("ResponseField", context),
    Step,
    Steps,
    Tab,
    Tabs,
    Tile: (props) => <Tile {...props} context={context} />,
    Tip: calloutComponent("Tip"),
    Update: (props) => <Update {...props} context={context} />,
    VersionBadge,
    Warning: calloutComponent("Warning"),
    YouTubeEmbed,
  };
}

function calloutComponent(kind: string): ComponentType<ComponentProps> {
  return function Callout({ children }) {
    return (
      <aside className={`callout ${kind.toLowerCase()}`}>
        <span className="callout-icon" aria-hidden="true">
          <CalloutIcon kind={kind} />
        </span>
        <div className="callout-body">{children}</div>
      </aside>
    );
  };
}

function iframeProps(props: ComponentProps): Record<string, unknown> {
  const allowed = new Set([
    "allow",
    "allowFullScreen",
    "height",
    "loading",
    "referrerPolicy",
    "sandbox",
    "title",
    "width",
  ]);
  return Object.fromEntries(Object.entries(props).filter(([key]) => allowed.has(key)));
}

function headingComponent(level: number, context: RenderContext): ComponentType<ComponentProps> {
  return function Heading({ children }) {
    const title = childrenToText(children);
    const anchor = uniqueAnchor(slugify(title), context.anchors);
    const entryType = headingEntryType(level, title, context);

    if (entryType && !context.suppressSectionEntries) {
      context.entries.push({ name: title, type: entryType, path: `${context.currentPath}#${anchor}` });
    }

    const HeadingTag = `h${level}` as keyof JSX.IntrinsicElements;
    return (
      <>
        {entryType && !context.suppressSectionEntries ? (
          <a
            // @ts-ignore
            name={`//apple_ref/cpp/${entryType}/${encodeURIComponent(title)}`}
            className="dashAnchor"
          />
        ) : null}
        <HeadingTag id={anchor}>{children}</HeadingTag>
      </>
    );
  };
}

function headingEntryType(
  level: number,
  title: string,
  context: RenderContext,
): "Section" | "Function" | "Class" | "Method" | null {
  if (!context.isSdkPage) return level <= 3 ? "Section" : null;

  if (level === 2 && (title === "Functions" || title === "Classes")) {
    context.sdkSection = title;
    return null;
  }
  if (level === 3 && context.sdkSection === "Functions") return "Function";
  if (level === 3 && context.sdkSection === "Classes") return "Class";
  if (level === 4 && context.sdkSection === "Classes") return "Method";
  return null;
}

function fieldComponent(
  componentName: "ParamField" | "ResponseField",
  context: RenderContext,
): ComponentType<ComponentProps> {
  return function Field({ children, ...props }) {
    const name = String(props.body ?? props.name ?? "field");
    const type = typeof props.type === "string" ? props.type : "";
    const defaultValue = typeof props.default === "string" ? props.default : "";
    const anchor = uniqueAnchor(slugify(`${componentName}-${name}`), context.anchors);
    context.entries.push({ name, type: "Parameter", path: `${context.currentPath}#${anchor}` });

    return (
      <section className="param-field" id={anchor}>
        <h4>
          <code>{name}</code>
        </h4>
        {type || defaultValue || props.required ? (
          <p className="field-meta">
            {type ? <code>{type}</code> : null}
            {defaultValue ? (
              <span>
                {" default: "}
                <code>{defaultValue}</code>
              </span>
            ) : null}
            {props.required ? <span className="required"> required</span> : null}
          </p>
        ) : null}
        {children}
      </section>
    );
  };
}

function Card({
  children,
  title,
  href,
  description,
  img,
  context,
}: ComponentProps & { context: RenderContext }) {
  const normalizedHref = typeof href === "string" ? normalizeHref(href, context) : href;
  const normalizedImg = typeof img === "string" ? normalizeHref(img, context) : img;
  const image = normalizedImg ? (
    <img alt={String(title ?? "")} className="card-img" src={String(normalizedImg)} />
  ) : null;

  if (typeof href === "string") {
    return (
      <section className="card">
        <a className="card-link" href={String(normalizedHref)}>
          {image}
          {title ? <h3>{String(title)}</h3> : null}
          {description ? <p>{String(description)}</p> : null}
          {children}
        </a>
      </section>
    );
  }

  return (
    <section className="card">
      {image}
      {title ? <h3>{String(title)}</h3> : null}
      {description ? <p>{String(description)}</p> : null}
      {children}
    </section>
  );
}

function CardGroup({ children }: ComponentProps) {
  return <div className="card-group">{children}</div>;
}

function CodeGroup({ children }: ComponentProps) {
  return <section className="docset-tabs">{children}</section>;
}

function Expandable({ children, title }: ComponentProps) {
  return (
    <details className="expandable" open>
      <summary>{String(title ?? "Details")}</summary>
      {children}
    </details>
  );
}

function AccordionGroup({ children }: ComponentProps) {
  return <section className="accordion-group">{children}</section>;
}

function Frame({ children }: ComponentProps) {
  return <figure className="frame">{children}</figure>;
}

function Icon({ icon, style }: ComponentProps) {
  const label = typeof icon === "string" ? icon : "icon";
  const styleValue = parseInlineStyle(style);

  if (label === "github") {
    return (
      <svg
        aria-label="GitHub"
        className="inline-icon"
        fill="currentColor"
        role="img"
        style={styleValue}
        viewBox="0 0 16 16"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 3.86c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
      </svg>
    );
  }

  return <span className="inline-icon" style={styleValue} aria-label={label} />;
}

function parseInlineStyle(value: unknown): CSSProperties | undefined {
  if (!value) return undefined;
  if (typeof value === "object") return value as CSSProperties;
  if (typeof value !== "string") return undefined;

  const style: Record<string, string> = {};
  for (const declaration of value.split(";")) {
    const [property, ...rawValue] = declaration.split(":");
    if (!property || rawValue.length === 0) continue;
    const key = property.trim().replace(/-([a-z])/g, (_match, char: string) => char.toUpperCase());
    style[key] = rawValue.join(":").trim();
  }
  return style as CSSProperties;
}

function LocalFocusTip() {
  return (
    <aside className="callout tip">
      <span className="callout-icon" aria-hidden="true">
        <CalloutIcon kind="Tip" />
      </span>
      <div className="callout-body">
        <p>
          <strong>This integration focuses on running local FastMCP server files with STDIO transport.</strong>
          {" For remote servers running with HTTP or SSE transport, use your client's native configuration."}
        </p>
      </div>
    </aside>
  );
}

function PrefabPinWarning() {
  return (
    <aside className="callout tip">
      <span className="callout-icon" aria-hidden="true">
        <CalloutIcon kind="Tip" />
      </span>
      <div className="callout-body">
        <p>
          <a href="https://prefab.prefect.io">Prefab</a>
          {" is under active development with frequent breaking changes. FastMCP sets a minimum "}
          <code>prefab-ui</code>
          {" version but does not pin an upper bound. Pin "}
          <code>prefab-ui</code>
          {" to a specific version in your own dependencies before deploying."}
        </p>
      </div>
    </aside>
  );
}

function Prompt({ children, description }: ComponentProps) {
  return (
    <section className="prompt">
      {description ? <p className="muted">{String(description)}</p> : null}
      <pre>
        <code>{childrenToText(children)}</code>
      </pre>
    </section>
  );
}

function Step({ children, title }: ComponentProps) {
  return (
    <li className="docset-step">
      <h4>{String(title ?? "Step")}</h4>
      {children}
    </li>
  );
}

function Steps({ children }: ComponentProps) {
  return <ol className="docset-steps">{children}</ol>;
}

function Tab({ children, title }: ComponentProps) {
  return (
    <section className="docset-tab-panel">
      <h4 className="docset-tab-title">{String(title ?? "Tab")}</h4>
      {children}
    </section>
  );
}

function Tabs({ children }: ComponentProps) {
  return <section className="docset-tabs">{children}</section>;
}

function Tile({ title, description, href, context }: ComponentProps & { context: RenderContext }) {
  const normalizedHref = typeof href === "string" ? normalizeHref(href, context) : href;
  return (
    <a className="tile" href={String(normalizedHref ?? "#")}>
      <strong>{String(title ?? "")}</strong>
      <span>{String(description ?? "")}</span>
    </a>
  );
}

function Update({
  children,
  label,
  description,
  context,
}: ComponentProps & { context: RenderContext }) {
  const version = String(label ?? "Update");
  const anchor = uniqueAnchor(slugify(version), context.anchors);
  context.entries.push({ name: version, type: "Section", path: `${context.currentPath}#${anchor}` });

  const previousSuppressSectionEntries = context.suppressSectionEntries;
  context.suppressSectionEntries = true;
  const bodyHtml = renderToStaticMarkup(<>{children}</>);
  context.suppressSectionEntries = previousSuppressSectionEntries;

  return (
    <article className="update" id={anchor}>
      <a {...{ name: `//apple_ref/cpp/Section/${encodeURIComponent(version)}` }} className="dashAnchor" />
      <aside className="update-meta">
        <span className="update-version">{version}</span>
        {description ? <time>{String(description)}</time> : null}
      </aside>
      <div className="update-body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
    </article>
  );
}

function VersionBadge({ version }: ComponentProps) {
  return (
    <span className="version-badge">
      New in version <code>{String(version)}</code>
    </span>
  );
}

function YouTubeEmbed({ videoId, title }: ComponentProps) {
  if (!videoId) return null;
  return (
    <iframe
      className="docset-iframe-demo"
      src={`https://www.youtube.com/embed/${String(videoId)}`}
      title={String(title ?? "YouTube video")}
    />
  );
}

function normalizeHref(value: string, context: RenderContext): string {
  if (!value) return value;
  if (/^(https?:|mailto:|data:)/.test(value) || value.startsWith("#")) return value;

  const [splitPath, splitAnchor] = value.split("#", 2);
  const rawPath = splitPath ?? "";
  const anchor = splitAnchor ?? "";
  if (rawPath.startsWith("/")) {
    const path = rawPath.slice(1);
    if (context.missingMedia.has(path)) {
      return `${context.onlineBaseUrl.replace(/\/$/, "")}/${path}`;
    }
    const target = extname(path) ? path : slugToHtmlPath(path);
    return `${relativePathTo(context.currentPath, target)}${anchor ? `#${anchor}` : ""}`;
  }
  if (!extname(rawPath) && !rawPath.startsWith(".")) {
    return `${relativePathTo(context.currentPath, slugToHtmlPath(rawPath))}${anchor ? `#${anchor}` : ""}`;
  }
  return value;
}

function relativePathTo(currentPath: string, targetPath: string): string {
  const prefix = "../".repeat(Math.max(0, currentPath.split("/").length - 1));
  return `${prefix}${targetPath}`;
}

function slugToHtmlPath(slug: string): string {
  return `${slug.replace(/\/$/, "")}/index.html`;
}

function childrenToText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(childrenToText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return childrenToText(node.props.children);
  return "";
}

function uniqueAnchor(base: string, counts: Map<string, number>): string {
  const count = counts.get(base) ?? 0;
  counts.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^\wа-яА-ЯёЁ]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "section"
  );
}

function CalloutIcon({ kind }: { kind: string }) {
  if (kind === "Warning") {
    return (
      <svg
        aria-label="Warning"
        fill="none"
        height={20}
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
        width={20}
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (kind === "Tip") {
    return (
      <svg
        aria-label="Tip"
        fill="currentColor"
        height={14}
        viewBox="0 0 11 14"
        width={11}
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M3.12794 12.4232C3.12794 12.5954 3.1776 12.7634 3.27244 12.907L3.74114 13.6095C3.88471 13.8248 4.21067 14 4.46964 14H6.15606C6.41415 14 6.74017 13.825 6.88373 13.6095L7.3508 12.9073C7.43114 12.7859 7.49705 12.569 7.49705 12.4232L7.50055 11.3513H3.12521L3.12794 12.4232ZM5.31288 0C2.52414 0.00875889 0.5 2.26889 0.5 4.78826C0.5 6.00188 0.949566 7.10829 1.69119 7.95492C2.14321 8.47011 2.84901 9.54727 3.11919 10.4557C3.12005 10.4625 3.12175 10.4698 3.12261 10.4771H7.50342C7.50427 10.4698 7.50598 10.463 7.50684 10.4557C7.77688 9.54727 8.48281 8.47011 8.93484 7.95492C9.67728 7.13181 10.1258 6.02703 10.1258 4.78826C10.1258 2.15486 7.9709 0.000106649 5.31288 0ZM7.94902 7.11267C7.52078 7.60079 6.99082 8.37878 6.6077 9.18794H4.02051C3.63739 8.37878 3.10743 7.60079 2.67947 7.11294C2.11997 6.47551 1.8126 5.63599 1.8126 4.78826C1.8126 3.09829 3.12794 1.31944 5.28827 1.3126C7.2435 1.3126 8.81315 2.88226 8.81315 4.78826C8.81315 5.63599 8.50688 6.47551 7.94902 7.11267ZM4.87534 2.18767C3.66939 2.18767 2.68767 3.16939 2.68767 4.37534C2.68767 4.61719 2.88336 4.81288 3.12521 4.81288C3.36705 4.81288 3.56274 4.61599 3.56274 4.37534C3.56274 3.6515 4.1515 3.06274 4.87534 3.06274C5.11719 3.06274 5.31288 2.86727 5.31288 2.62548C5.31288 2.38369 5.11599 2.18767 4.87534 2.18767Z" />
      </svg>
    );
  }

  if (kind === "Info") {
    return (
      <svg
        aria-label="Info"
        fill="currentColor"
        height={20}
        viewBox="0 0 20 20"
        width={20}
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M8 0C3.58125 0 0 3.58125 0 8C0 12.4187 3.58125 16 8 16C12.4187 16 16 12.4187 16 8C16 3.58125 12.4187 0 8 0ZM8 14.5C4.41563 14.5 1.5 11.5841 1.5 8C1.5 4.41594 4.41563 1.5 8 1.5C11.5844 1.5 14.5 4.41594 14.5 8C14.5 11.5841 11.5844 14.5 8 14.5ZM9.25 10.5H8.75V7.75C8.75 7.3375 8.41563 7 8 7H7C6.5875 7 6.25 7.3375 6.25 7.75C6.25 8.1625 6.5875 8.5 7 8.5H7.25V10.5H6.75C6.3375 10.5 6 10.8375 6 11.25C6 11.6625 6.3375 12 6.75 12H9.25C9.66406 12 10 11.6641 10 11.25C10 10.8359 9.66563 10.5 9.25 10.5ZM8 6C8.55219 6 9 5.55219 9 5C9 4.44781 8.55219 4 8 4C7.44781 4 7 4.44687 7 5C7 5.55313 7.44687 6 8 6Z" />
      </svg>
    );
  }

  return (
    <svg
      aria-label="Note"
      fill="currentColor"
      height={14}
      viewBox="0 0 14 14"
      width={14}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        clipRule="evenodd"
        d="M7 1.3C10.14 1.3 12.7 3.86 12.7 7C12.7 10.14 10.14 12.7 7 12.7C5.48908 12.6974 4.0408 12.096 2.97241 11.0276C1.90403 9.9592 1.30264 8.51092 1.3 7C1.3 3.86 3.86 1.3 7 1.3ZM7 0C3.14 0 0 3.14 0 7C0 10.86 3.14 14 7 14C10.86 14 14 10.86 14 7C14 3.14 10.86 0 7 0ZM8 3H6V8H8V3ZM8 9H6V11H8V9Z"
        fillRule="evenodd"
      />
    </svg>
  );
}
