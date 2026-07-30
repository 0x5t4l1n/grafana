import { type NavModelItem } from '@grafana/data';
import { config } from '@grafana/runtime';
import { contextSrv } from 'app/core/services/context_srv';

import { NavID } from './constants';

export const has = (action: string) => contextSrv.hasPermission(action);
export const hasAny = (...actions: string[]) => actions.some(has);
export const isSignedIn = () => contextSrv.isSignedIn;
export const isOrgAdmin = () => contextSrv.user.orgRole === 'Admin';

const isDefined = <T>(item: T | false | undefined): item is T => Boolean(item);

export interface NavEntryBuilder {
  /** Whether this item is visible at all (permission/config/sign-in gates) */
  when: () => boolean;
  /** Builds the nav item; may return undefined when, despite the gate, no
   * accessible children remain (e.g. Alerting with no alerting permissions) */
  build: () => NavModelItem | undefined;
}

export const buildEntries = (entries: NavEntryBuilder[]): NavModelItem[] =>
  entries
    .filter((entry) => entry.when())
    .map((entry) => entry.build())
    .filter(isDefined);

/** Depth-first search of a nav tree by item id */
export function findNavById(nodes: NavModelItem[], id: string): NavModelItem | undefined {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const found = node.children && findNavById(node.children, id);
    if (found) {
      return found;
    }
  }
  return undefined;
}

/** Returns a new tree with the matching node (at any depth) replaced by update(node) */
export function updateNavById(
  nodes: NavModelItem[],
  id: string,
  update: (node: NavModelItem) => NavModelItem
): NavModelItem[] {
  return nodes.map((node) => {
    if (node.id === id) {
      return update(node);
    }
    return node.children ? { ...node, children: updateNavById(node.children, id, update) } : node;
  });
}

/**
 * Prefixes every absolute url in the tree with the app sub url, so individual
 * items are declared sub-url agnostic. Anchor-only and relative urls (Help's
 * `#`) are left alone. Returns a new tree.
 */
export function applyAppSubUrl(tree: NavModelItem[]): NavModelItem[] {
  if (!config.appSubUrl) {
    return tree;
  }
  return tree.map((node) => ({
    ...node,
    url: node.url?.startsWith('/') ? `${config.appSubUrl}${node.url}` : node.url,
    children: node.children ? applyAppSubUrl(node.children) : node.children,
  }));
}

/**
 * Mirrors NavTreeRoot.Sort: stable sort by sortWeight, items without a weight
 * keep their insertion position, applied recursively. Returns a new tree.
 */
export function sortNavTree(nodes: NavModelItem[]): NavModelItem[] {
  const weightOf = (node: NavModelItem, index: number) => node.sortWeight || index + 1;

  return nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) => weightOf(a.node, a.index) - weightOf(b.node, b.index) || a.index - b.index)
    .map(({ node }) => (node.children ? { ...node, children: sortNavTree(node.children) } : node));
}

// Admin subsections that exist as attachment targets and are pruned when
// nothing attached, matching RemoveEmptyAdminSections
const PRUNABLE_ADMIN_SECTIONS: string[] = [NavID.cfgGeneral, NavID.cfgPlugins, NavID.cfgAccess];

/**
 * Mirrors NavTreeRoot.RemoveEmptyAdminSections/RemoveEmptyConnectionsSection:
 * the Connections shell and the admin subsections (General, Plugins and data,
 * Users and access) are always built so plugin pages and enterprise items can
 * attach to them, then pruned when nothing did. Returns a new tree.
 */
export function pruneEmptyNavSections(tree: NavModelItem[]): NavModelItem[] {
  const isEmpty = (node: NavModelItem) => (node.children ?? []).length === 0;

  return tree
    .map((node) => {
      if (node.id !== NavID.cfg || !node.children) {
        return node;
      }
      return {
        ...node,
        children: node.children.filter(
          (child) => !(child.id && PRUNABLE_ADMIN_SECTIONS.includes(child.id) && isEmpty(child))
        ),
      };
    })
    .filter((node) => !((node.id === NavID.cfg || node.id === NavID.connections) && isEmpty(node)));
}

/**
 * Transitional: enterprise injects admin nav items server-side via
 * RunIndexDataHooks, which the client builder cannot know about. Splice any
 * admin items present in the server tree but missing from the client-built
 * one. Returns a new tree; removed when the bootdata navTree goes away.
 */
export function graftEnterpriseAdminItems(tree: NavModelItem[], bootNavTree: NavModelItem[]): NavModelItem[] {
  const bootAdminSection = bootNavTree.find((node) => node.id === NavID.cfg);
  const clientAdminSection = tree.find((node) => node.id === NavID.cfg);
  if (!bootAdminSection?.children || !clientAdminSection?.children) {
    return tree;
  }

  // Appends any of bootParent's children whose ids the client children don't have
  const addMissingChildren = (clientChildren: NavModelItem[], bootParent: NavModelItem): NavModelItem[] => {
    const knownIds = new Set(clientChildren.map((child) => child.id));
    const missing = (bootParent.children ?? []).filter((child) => child.id && !knownIds.has(child.id));
    return [...clientChildren, ...missing];
  };

  // 1. Splice in whole admin children the client didn't build (e.g. an
  //    enterprise-only admin section)
  const withMissingSections = addMissingChildren(clientAdminSection.children, bootAdminSection);

  // 2. Within each subsection both trees have (General, Plugins and data,
  //    Users and access), splice in hook-injected leaves (e.g. Stats and license)
  const mergedAdminChildren = withMissingSections.map((clientChild) => {
    const bootChild = bootAdminSection.children?.find((node) => node.id === clientChild.id);
    if (!bootChild?.children?.length) {
      return clientChild;
    }
    return { ...clientChild, children: addMissingChildren(clientChild.children ?? [], bootChild) };
  });

  return tree.map((node) => (node.id === NavID.cfg ? { ...node, children: sortNavTree(mergedAdminChildren) } : node));
}
