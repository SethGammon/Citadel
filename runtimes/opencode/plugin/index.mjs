// Citadel plugin for opencode.
//
// opencode loads this module in-process (under Bun) and calls the hooks it
// returns as (input, output) => Promise<void>. Two opencode behaviors drive the
// whole shape of this file:
//
//   Blocking is `throw`. A rejection from tool.execute.before fails just that
//   tool call, with the thrown message reaching the model as the tool result.
//
//   Mutation is in place. session/tools.ts passes the original `args` object to
//   the tool, not `output.args`, so assigning `output.args = {...}` is silently
//   discarded while `output.args.command = '...'` is honored.
//
// The real work lives in hook-runner.js (CommonJS) so Citadel's own test suite
// can exercise it under plain Node without Bun or opencode installed.
//
// Known limitation: if this module fails to load, opencode reports a plugin
// error and continues with no Citadel gating at all. That fail-open is opencode's
// behavior, not something the plugin can prevent, so the module keeps its load
// path as small as possible and does no work at import time.

import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const runner = require('./hook-runner.js');
const notices = require('./pending-notices.js');
const reprompt = require('./reprompt.js');
const skillCommand = require('./skill-command.js');

// A part pushed onto `output.parts` is a materialized Part, not the input shape:
// opencode validates it against a schema requiring `id` (`^prt`), `sessionID` and
// `messageID`, and a part missing them fails the whole prompt request with a 500
// before the turn runs. Verified live on opencode 1.18.30.
//
// The id is generated rather than taken from opencode, which exposes no id
// factory to plugins. It leads with 'z' so it sorts after every real part id,
// whose 12-char time segment is a hex millisecond clock and therefore starts with
// a digit for the next several centuries.
function newPartId() {
  return `prt_z${randomBytes(13).toString('hex').slice(0, 25)}`;
}

// sessionID and messageID are read off a sibling part first, because that is the
// value opencode itself just wrote. `output.message` and the hook input are
// fallbacks; all three were observed to carry them.
function partIdentity(input, output) {
  const parts = Array.isArray(output?.parts) ? output.parts : [];
  const sibling = parts[parts.length - 1] || {};
  const sessionID = sibling.sessionID || output?.message?.sessionID || input?.sessionID;
  const messageID = sibling.messageID || output?.message?.id || input?.messageID;
  if (typeof sessionID !== 'string' || typeof messageID !== 'string') return null;
  return { sessionID, messageID };
}

function blockedError(outcome) {
  const error = new Error(outcome.reason || '[citadel] blocked by a Citadel hook');
  error.name = 'CitadelBlockedError';
  return error;
}

function taskLifecyclePayload(input, args, directory, status) {
  return {
    ...input,
    args,
    directory,
    task_id: input?.callID || input?.callId || null,
    agent_id: input?.callID || input?.callId || null,
    subagent_id: input?.callID || input?.callId || null,
    agent_type: args?.agent || null,
    subagent_type: args?.agent || null,
    title: args?.description || args?.prompt || args?.agent || null,
    status,
  };
}

async function observe(event, payload, options) {
  try {
    return await runner.runHooksForEvent(event, payload, options);
  } catch (error) {
    // An observer must never break the session. Swallow and carry on; opencode
    // would otherwise surface this as a plugin error on every turn.
    return { event, blocked: false, reason: null, messages: [], results: [], skipped: [{ hook: null, reason: error.message }] };
  }
}

export const CitadelPlugin = async ({ project, directory, worktree, client } = {}) => {
  // `worktree` may be a broad filesystem root for a non-Git project. OpenCode's
  // active `directory` is the cwd skill commands must retain.
  const projectRoot = directory || project?.worktree || worktree || process.cwd();
  const options = { projectRoot };

  // Read once per instance: the policy governs autonomous model turns, so it
  // should not change under a running session because someone edited a file.
  const repromptConfig = reprompt.readConfig(projectRoot);
  const repromptGuard = reprompt.createGuard(repromptConfig);

  async function log(level, message, extra) {
    try {
      await client?.app?.log({ body: { service: 'citadel', level, message, extra } });
    } catch { /* logging must never break a turn */ }
  }

  // Ask opencode for one more turn so a stop-time finding is acted on now rather
  // than whenever a human next types. Off unless the project opts in; see
  // reprompt.js for the two guards. The finding itself is not repeated here --
  // it rides into the new turn through the same chat.message injection that a
  // human-typed prompt would carry.
  // Called on every session.idle, including the quiet ones -- see reprompt.js for
  // why a silent idle is load-bearing.
  async function maybeReprompt(sessionID, hasFinding) {
    // Checked before the guard is consulted, so a runtime that cannot re-prompt
    // at all does not burn the session's budget discovering that every turn.
    if (typeof client?.session?.promptAsync !== 'function') return;
    const decision = repromptGuard.consider(sessionID, hasFinding);
    if (!decision.send) {
      // 'disabled' and 'no-finding' are the normal quiet paths and would be
      // logged on every idle; only the guards actually declining is news.
      if (decision.reason === 'cap-reached' || decision.reason === 'idle-follows-reprompt') {
        await log('info', 'citadel reprompt skipped', { reason: decision.reason, sessionID });
      }
      return;
    }
    try {
      await client.session.promptAsync({
        path: { id: sessionID },
        body: { parts: [{ type: 'text', text: reprompt.REPROMPT_TEXT }] },
      });
      await log('info', 'citadel reprompt sent', { sessionID, sent: decision.sent, cap: decision.cap });
    } catch (error) {
      // A failed re-prompt still spent its slot. That is the safe direction:
      // the notice is already persisted and the next human turn will carry it.
      await log('warn', 'citadel reprompt failed', { sessionID, error: String(error).slice(0, 300) });
    }
  }

  // The plugin's init function is the only thing opencode runs once per project
  // directory before any turn, so it stands in for SessionStart.
  const start = await observe('plugin.init', { directory: projectRoot }, options);
  if (start.messages.length) await log('info', 'citadel session start', { messages: start.messages });

  return {
    async 'shell.env'(_input, output) {
      skillCommand.injectShellEnvironment(output?.env, projectRoot);
    },

    async 'tool.execute.before'(input, output) {
      if (input?.tool === 'bash' && typeof output?.args?.command === 'string') {
        output.args.command = skillCommand.rewriteSkillCommand(output.args.command, projectRoot);
      }
      const outcome = await runner.runHooksForEvent('tool.execute.before', {
        ...input,
        args: output.args,
        directory: projectRoot,
      }, options);

      if (outcome.blocked) throw blockedError(outcome);

      // OpenCode has no TaskCreated event. Emit it only after the generic gate
      // permits the delegation, so rejected task calls do not become starts.
      if (input?.tool === 'task') {
        const task = taskLifecyclePayload(input, output.args, projectRoot, 'created');
        await observe('task.created', task, options);
        await observe('subagent.start', task, options);
      }
    },

    async 'tool.execute.after'(input, output) {
      const outcome = await observe('tool.execute.after', {
        ...input,
        args: input.args,
        directory: projectRoot,
      }, options);

      // The task tool returns only after its delegated agent finishes. Mirror
      // Claude Code's TaskCompleted boundary and preserve a reported failure.
      if (input?.tool === 'task') {
        const task = taskLifecyclePayload(
          input,
          input.args,
          projectRoot,
          output?.status || (output?.error ? 'failed' : 'completed'),
        );
        await observe('task.completed', task, options);
        await observe('subagent.stop', task, options);
      }

      // Never throw here: the tool already ran, and rejecting would report a
      // successful call as failed. Append findings to the output the model sees.
      if (outcome.messages.length && typeof output.output === 'string') {
        output.output = `${output.output}\n\n${outcome.messages.join('\n')}`;
      }
    },

    async 'chat.message'(input, output) {
      const outcome = await observe('chat.message', { ...input, directory: projectRoot }, options);

      // Deliver whatever the end of the previous turn could not. session.idle is
      // dispatched fire-and-forget by opencode, so a stop-time finding cannot
      // refuse anything; this is the turn where it reaches the model.
      //
      // Only this session's findings: the store is per project and opencode runs
      // many sessions in one, so an unscoped read would hand session A's finding
      // to session B and leave A none the wiser.
      const identity = partIdentity(input, output);
      const sessionID = input?.sessionID || identity?.sessionID || null;

      // Notices are peeked, not drained, until the push is known to be possible.
      // Draining first loses the finding for good on any turn we cannot inject
      // into, and the store holds the only copy.
      let deferred = [];
      try {
        deferred = notices.peek(projectRoot, sessionID);
      } catch { /* never break a turn over a notice */ }

      const texts = [...outcome.messages];
      if (deferred.length) texts.push(notices.renderForPrompt(deferred));
      if (!texts.length) return;

      // Pushing onto the existing parts array injects context; replacing
      // output.parts would be discarded, because prompt.ts keeps iterating the
      // array it handed in.
      if (!Array.isArray(output.parts)) return;
      // Without an identity the part cannot be built, and pushing a partial one
      // does not degrade quietly -- it fails the whole turn with a 500. Stay
      // silent instead, and leave the notices for a turn that can carry them.
      if (!identity) return;
      output.parts.push({
        id: newPartId(),
        sessionID: identity.sessionID,
        messageID: identity.messageID,
        type: 'text',
        text: texts.join('\n\n'),
        synthetic: true,
      });

      if (deferred.length) {
        try {
          notices.drain(projectRoot, sessionID);
        } catch { /* a duplicate next turn beats a dropped finding */ }
      }
    },

    async config(config) {
      await observe('config', { directory: projectRoot, config }, options);
    },

    // opencode dispatches bus events fire-and-forget, so everything here is
    // observation only. Notably session.idle cannot block the way a Claude Code
    // Stop hook can.
    async event({ event }) {
      if (!event?.type) return;
      if (!runner.TEMPLATE_EVENT_BY_OPENCODE_EVENT[event.type]) return;
      const outcome = await observe(event.type, {
        ...(event.properties || {}),
        directory: projectRoot,
      }, options);

      // A stop-time finding would otherwise be discarded, because nothing awaits
      // this handler and nothing can act on its result. Persist it so the next
      // chat.message can hand it to the model. Deduped and capped in the store,
      // because session.idle fires repeatedly with the same verdict.
      if (event.type === 'session.idle') {
        if (outcome.messages.length) {
          try {
            notices.record(projectRoot, event.type, outcome.messages, {
              sessionID: event.properties?.sessionID,
            });
          } catch { /* an undeliverable notice must not break the session */ }
        }
        // Every idle, finding or not: the guard's loop mark is consumed here.
        await maybeReprompt(event.properties?.sessionID, outcome.messages.length > 0);
      }

      if (!outcome.messages.length) return;
      await log('info', `citadel ${event.type}`, { messages: outcome.messages });
    },

    async dispose() {
      await observe('dispose', { directory: projectRoot }, options);
    },
  };
};

export default CitadelPlugin;
