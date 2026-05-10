import type React from "react";
import type { JSX as ReactJSX } from "react";

declare global {
  namespace JSX {
    type Element = ReactJSX.Element;
    interface ElementClass extends React.Component<unknown> {
      render(): React.ReactNode;
    }
    interface ElementAttributesProperty {
      props: unknown;
    }
    interface ElementChildrenAttribute {
      children: unknown;
    }
    interface IntrinsicAttributes extends ReactJSX.IntrinsicAttributes {}
    interface IntrinsicElements extends ReactJSX.IntrinsicElements {}
  }
}

export {};
