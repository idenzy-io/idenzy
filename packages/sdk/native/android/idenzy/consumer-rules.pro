# Applied to the app that depends on this library. JNA and the generated bindings are reached by
# reflection and by name from native code, so a shrinker that renames or removes them breaks the
# first call into the core at runtime rather than the build.
-keep class com.sun.jna.** { *; }
-keep class * implements com.sun.jna.** { *; }
-keep class io.idenzy.core.** { *; }
-dontwarn java.awt.**
