# Run from the repository root: vhs demo/skill-picker.tape
Output demo/skill-picker.gif

Set Shell "bash"
Set Width 1100
Set Height 720
Set FontSize 18
Set TypingSpeed 35ms
Set Theme "Catppuccin Mocha"

Type "cd demo"
Enter
Sleep 1s

# --no-session keeps each recording fresh; --no-tools makes the answer read-only.
# --approve trusts the checked-in project skills without an interactive trust prompt.
Type "pi --no-extensions --extension ../src/extension.ts --no-session --approve --no-tools"
Enter
Sleep 4s

Type "For this storefront, how would you add a low-stock report? Outline only; don't edit files or run tools."
Enter

# Allow time for the decision request AND the model response. Increase on slow connections.
Sleep 45s
Type "/skill-picker history"
Enter
Sleep 5s
