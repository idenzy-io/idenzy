require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

# For a Capacitor app on CocoaPods rather than Swift Package Manager. Until the Swift SDK is on
# CocoaPods trunk, such an app names IdenzyCore, Idenzy and IdenzyBridge by path itself.
Pod::Spec.new do |s|
  s.name = 'IdenzyCapacitor'
  s.version = package['version']
  s.summary = package['description']
  s.homepage = 'https://github.com/idenzy-io/idenzy'
  s.license = package['license']
  s.authors = 'Idenzy'
  s.source = { :git => 'https://github.com/idenzy-io/idenzy.git', :tag => "v#{s.version}" }
  s.platforms = { :ios => '15.0' }
  s.swift_version = '5.9'
  s.source_files = 'ios/Sources/**/*.swift'
  s.dependency 'Capacitor'
  s.dependency 'IdenzyBridge'
end
