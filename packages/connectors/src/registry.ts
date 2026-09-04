import type { Platform } from '@pf/core';
import type { Agent } from './base/agent.js';
import type { Connector } from './base/connector.js';
import { mockConnector } from './mock/index.js';
import { linkedinConnector } from './linkedin/index.js';

const connectors: Record<Platform, Connector> = {
  mock: mockConnector,
  linkedin: linkedinConnector,
};

export function getConnector(platform: Platform): Connector {
  const connector = connectors[platform];
  if (!connector) throw new Error(`Unknown platform: ${platform}`);
  return connector;
}

export function listConnectors(): Connector[] {
  return Object.values(connectors);
}

/** Every agent across every connector - what the API exposes to the dashboard. */
export function listAgents(): Agent[] {
  return listConnectors().flatMap((c) => c.agents);
}

export function getAgent(key: string): Agent {
  const agent = listAgents().find((a) => a.key === key);
  if (!agent) throw new Error(`Unknown agent: ${key}`);
  return agent;
}
