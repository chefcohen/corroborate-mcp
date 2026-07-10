/**
 * Billing: pay-per-verdict. The ONLY charged event is an actual tool call (tools/call) —
 * discovery (initialize, tools/list, pings, notifications) is free. Agents should be able to
 * find and inspect the tools without spending; they pay when they get a verdict.
 */
import { Actor, log } from 'apify';

export async function chargeMessageRequest(request: { method: string }): Promise<void> {
    const { method } = request;

    if (method === 'tools/call') {
        await Actor.charge({ eventName: 'tool-request' });
        log.info(`Charged for tool call: ${method}`);
    } else {
        log.info(`Not charging for method: ${method}`);
    }
}
