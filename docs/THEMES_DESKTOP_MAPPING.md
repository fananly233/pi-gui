# Pi GUI and Pi Themes

Pi GUI currently has two separate theme concepts. They are intentionally not mapped to each other.

## Desktop shell theme

The React shell supports `light` and `dark`. The title-bar toggle stores the preference in WebView local storage under `pi-theme`, applies it on startup, and updates the xterm palette.

This setting changes Pi GUI only. It does not write Pi configuration or select a Pi TUI theme.

## Pi theme inventory

The Packages/Resources panel lists:

- Pi built-in `dark` and `light`;
- direct JSON themes under the user's Pi themes directory;
- direct project themes for the selected workspace.

The Rust command parses only bounded metadata needed for the list. Package-owned themes remain managed through their package and are not expanded into a second desktop package model.

## Current limitations

Pi GUI `0.1.0` does not:

- bundle or auto-install a Pi theme set;
- repair or rewrite user theme files;
- activate a Pi theme;
- project Pi JSON color tokens into React CSS variables;
- duplicate the interactive `pi config` theme picker.

Any future mapping must define a stable Pi schema contract, preserve user files, and keep desktop-shell preference separate from Pi runtime configuration.
