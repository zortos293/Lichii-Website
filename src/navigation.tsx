import { Link as RouterLink, NavLink as RouterNavLink, useLocation, useResolvedPath, type LinkProps, type NavLinkProps } from 'react-router-dom';
import { needsDocumentNavigation } from './tracking-policy.ts';

export function Link(props: LinkProps) {
  const location = useLocation();
  const target = useResolvedPath(props.to, { relative: props.relative });
  return <RouterLink {...props} reloadDocument={props.reloadDocument || needsDocumentNavigation(location.pathname, target.pathname)} />;
}

export function NavLink(props: NavLinkProps) {
  const location = useLocation();
  const target = useResolvedPath(props.to, { relative: props.relative });
  return <RouterNavLink {...props} reloadDocument={props.reloadDocument || needsDocumentNavigation(location.pathname, target.pathname)} />;
}
