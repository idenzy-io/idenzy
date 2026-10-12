# The Swift SDK for CocoaPods, which React Native and other pod-based hosts link instead of a
# Swift package (ADR-0022). Three pods for the three modules, so each keeps the module name the
# others import. The sources and the XCFramework are what scripts/build-apple.sh produces.
Pod::Spec.new do |s|
  s.name = 'IdenzyCore'
  s.version = '0.1.0'
  s.summary = 'The generated Swift bindings of the Idenzy core, and the core itself.'
  s.homepage = 'https://github.com/idenzy-io/idenzy'
  s.license = { :type => 'MIT' }
  s.authors = 'Idenzy'
  # The release zip scripts/package-apple.sh writes, which carries the generated sources and the
  # XCFramework the repository does not; an app naming the pod by :path ignores this.
  s.source = { :http => "https://github.com/idenzy-io/idenzy/releases/download/v#{s.version}/idenzy-apple-#{s.version}.zip" }
  s.platforms = { :ios => '15.0' }
  s.swift_version = '5.9'
  s.source_files = 'Sources/IdenzyCore/**/*.swift'
  s.vendored_frameworks = 'IdenzyCoreFFI.xcframework'
end
