require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

# The Expo module that carries React Native's calls to IdenzyBridge. Until the Swift SDK is on
# CocoaPods trunk, an app names its three pods by path; the example does it through
# expo-build-properties' `ios.extraPods`.
Pod::Spec.new do |s|
  s.name = 'IdenzyReactNative'
  s.version = package['version']
  s.summary = package['description']
  s.homepage = 'https://github.com/idenzy-io/idenzy'
  s.license = package['license']
  s.authors = 'Idenzy'
  s.source = { :git => 'https://github.com/idenzy-io/idenzy.git', :tag => "v#{s.version}" }
  s.platforms = { :ios => '15.1' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.source_files = '*.swift'
  s.dependency 'ExpoModulesCore'
  s.dependency 'IdenzyBridge'
end
