{
  "targets": [
    {
      "target_name": "electron_panel",
      "sources": [
        "src/panel.cc",
        "src/panel_mac.mm"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        ["OS=='mac'", {
          "defines": ["PLATFORM_OSX"],
          "xcode_settings": {
            "OTHER_CPLUSPLUSFLAGS": ["-std=c++17", "-ObjC++"],
            "OTHER_LDFLAGS": ["-framework AppKit", "-framework QuartzCore"]
          }
        }]
      ]
    }
  ]
}
