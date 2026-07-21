import { createRoot, type Root } from "react-dom/client";
import { InvestmentGrowthCalculator } from "./InvestmentGrowthCalculator";
import "./tailwind.css";

const roots = new WeakMap<HTMLElement, Root>();

export function mountCalculator(element: HTMLElement): () => void {
  roots.get(element)?.unmount();
  const root = createRoot(element);
  roots.set(element, root);
  root.render(<InvestmentGrowthCalculator />);

  return () => {
    if (roots.get(element) === root) {
      root.unmount();
      roots.delete(element);
    }
  };
}