# Washos Packer Agent Guidelines

## Code Verification Pattern

This repository has a recurring bug pattern where references to singleton instances (like `Compoent.i`) are used without verifying they exist. To prevent this:

### Before Reporting Changes as Resolved

**For each function modified in a logic layer (utils/, stores/):**
1. Use `grep` to find its real consumer in the UI layer (ui/*.jsx)
2. Confirm the function is actually called from that location
3. Do not assume the function is used just because it exists

**For each new reference in JSX to an external identifier (another component, a singleton):**
1. Use `grep` to confirm that identifier exists
2. Verify it is accessible from that file (check imports)
3. Do not assume a pattern like `Component.i` exists without verification

### Example Verification Commands

```bash
# Verify a function is actually called
grep -rn "functionName" src/client/ui/

# Verify a singleton/component reference exists
grep -rn "APP.i\|Component.i" src/client/

# Verify imports match references
grep -n "import.*from" src/client/ui/SomeComponent.jsx
```

### Why This Matters

Historical bugs in this codebase:
- `APP.i` referenced in SmartSizePreview but never exposed
- `PackProperties.i` referenced but never exported
- Functions in utils/ assumed to be called but never actually used by any consumer

Always verify with execution or grep before claiming a fix is complete.

## API Verification

When fixing bugs related to external APIs (like Basis Universal WASM enums):
1. Execute the module directly in Node to verify enum names exist
2. Do not use names remembered from documentation - verify them
3. Include the actual console output in your response

## Code Style

- Use existing store patterns (e.g., `sparrowStore`, `animationOptionsStore`) for shared state
- Avoid creating new global singletons
- Follow the panel pattern used in ASTCConverter.jsx for new UI panels
