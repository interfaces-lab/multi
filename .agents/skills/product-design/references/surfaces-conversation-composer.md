# Conversation and composer

Assistant prose, work, and thinking are full-width text, never bubbles. Only user messages are
bubbled. Use the four-role ramp: primary prose, muted verbs, faint details, and mono evidence. Tool calls
do not receive status icons.

The composer is queue-first: Enter enqueues; idle queues drain immediately; running threads reveal the
queue tray; Command-Enter force-sends as a steer. One button changes label between Send and Queue. Do
not create separate send and queue modes. Questions embed in the composer without replacing its job.

The `/` and `@` suggestion menus share the Lexical trigger, keyboard, and rendering path in
`packages/app/src/chat/composer-editor.tsx`, driven by `use-prompt-menu.ts` over the pure
`prompt-menu-model.ts`. Both the start card and the thread reply mount that one editor and that one
driver. They are focused composite suggestions, distinct from the global engine in
`packages/app/src/command-menu.tsx`; do not fork `/` and `@` into separate editor implementations,
and do not give a surface its own composer.

A mention is a Lexical `DecoratorNode`, never a substring. The node carries its payload and
serializes itself through `getTextContent()`, so the submitted string is `$getRoot().getTextContent()`
and deleting a chip deletes what it referenced. Do not keep a parallel array of attachments beside
the text; reconciling the two is the bug this design exists to prevent.

The menus offer exactly what Pi supports: workspace files and folders behind `@`, and the workspace's
skills and prompt templates behind `/`, listed by `sdk.skills` and `sdk.commands` and run by
`sdk.session.runSkill` and `sdk.session.runCommand`. Pi formats those invocations, so the composer
never builds prompt text on its behalf. Anything else a mention might reference (a branch diff, an
earlier conversation, browser control) needs a Pi primitive that does not exist yet and belongs in an
extension, not in hand-rolled client-side prompt assembly.

Resolved turn diffs render as `ChangeReceipt` from `packages/ui/src/change-receipt.tsx` through
`packages/app/src/thread/transcript-turn.tsx`. Keep the receipt attached to its turn and actionable;
do not replace it with a decorative boundary.
