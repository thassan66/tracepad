Output docs/demo/tracepad-hero.gif

Set Shell "bash"
Set FontSize 16
Set Width 1320
Set Height 760
Set Theme "Catppuccin Mocha"
Set Padding 24

Hide
Type "bash docs/demo/setup-demo.sh && cd docs/demo/workspace && clear"
Enter
Sleep 500ms
Show

Type "node ../../../bin/tracepad.js init --hooks"
Enter
Sleep 900ms

Type "node ../../../bin/tracepad.js alias setup --shell bash > /tmp/tracepad-hook.sh && . /tmp/tracepad-hook.sh"
Enter
Sleep 700ms

Type "node ../../../bin/tracepad.js start 'Checkout timeout after deploy'"
Enter
Sleep 900ms

Type "npm test -- checkout-timeout || true"
Enter
Sleep 1700ms

Type "node ../../../bin/tracepad.js note 'retry token cache is stale after deployment' --kind hypothesis"
Enter
Sleep 800ms

Type "node ../../../bin/tracepad.js parse ./logs/server.log --context-lines 2 --max-matches 5 --note 'server failure excerpt'"
Enter
Sleep 900ms

Type "node ../../../bin/tracepad.js import browser-capture --file ../../../examples/browser-capture/checkout-incident.capture.json --note 'browser dashboard evidence'"
Enter
Sleep 900ms

Type "echo '// candidate fix: refresh token cache before checkout' >> test.js"
Enter
Sleep 500ms

Type "node ../../../bin/tracepad.js diff --note 'candidate fix before PR'"
Enter
Sleep 900ms

Type "node ../../../bin/tracepad.js replay --format markdown"
Enter
Sleep 1600ms

Type "node ../../../bin/tracepad.js export --format json --output session.json"
Enter
Sleep 700ms

Type "node ../../../bin/tracepad.js export --template slack --output session-slack.json"
Enter
Sleep 700ms

Type "node ../../../bin/tracepad.js export --format html --template handoff --output handoff.html"
Enter
Sleep 900ms

Type "node ../../../bin/tracepad.js status"
Enter
Sleep 1400ms

Type "node ../../../bin/tracepad.js tui"
Enter
Sleep 5s
Type "q"
Sleep 500ms
