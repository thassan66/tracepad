function exportSession(context) {
  const summary = context.helpers.summarizeSession(context.session);
  const recent = context.session.events.slice(-8).map((event) => context.helpers.renderEventLine(event));

  return JSON.stringify(
    {
      text: `Tracepad: ${context.session.title}`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: context.session.title,
          },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Status:* ${context.session.status}` },
            { type: "mrkdwn", text: `*Branch:* ${context.session.branch || "unknown"}` },
            { type: "mrkdwn", text: `*Notes:* ${summary.noteCount}` },
            { type: "mrkdwn", text: `*Commands:* ${summary.commandCount}` },
            { type: "mrkdwn", text: `*Snapshots:* ${summary.snapshotCount}` },
            { type: "mrkdwn", text: `*Failures:* ${summary.failingCommandCount}` },
          ],
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Recent timeline:*\n${recent.map((line) => `- ${line}`).join("\n") || "_No events captured yet._"}`,
          },
        },
      ],
    },
    null,
    2
  );
}

module.exports = { exportSession };
