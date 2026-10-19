// Small adapters so the ported StockXpert screens use TanStack Router.
import { useEffect, type ReactNode } from "react";
import { Link, useNavigate as useTsNavigate, useRouterState } from "@tanstack/react-router";

export function useNavigate() {
  const navigate = useTsNavigate();
  return (to: string, opts?: { replace?: boolean }) =>
    navigate({ to: to as never, replace: opts?.replace });
}

export function useLocation() {
  return useRouterState({ select: (s) => s.location });
}

export function useSearchParams(): [URLSearchParams] {
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  return [new URLSearchParams(searchStr)];
}

export function Navigate({ to, replace }: { to: string; replace?: boolean }) {
  const navigate = useTsNavigate();
  useEffect(() => {
    navigate({ to: to as never, replace });
  }, [to, replace, navigate]);
  return null;
}

type NavLinkProps = {
  to: string;
  end?: boolean;
  className?: string | ((s: { isActive: boolean }) => string);
  children?: ReactNode;
  onClick?: () => void;
  title?: string;
};

export function NavLink({ to, end, className, children, ...rest }: NavLinkProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = end || to === "/" ? pathname === to : pathname === to || pathname.startsWith(to + "/");
  const cls = typeof className === "function" ? className({ isActive }) : className;
  return (
    <Link to={to as never} className={cls} {...rest}>
      {children}
    </Link>
  );
}
