require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

# The Lynx native module that carries @idenzy/lynx's calls to IdenzyBridge. Objective-C because
# Lynx defines no Clang module for Swift to import. Until the Swift SDK is on CocoaPods trunk, an
# app names its three pods by path, as `example/ios/Podfile` does.
Pod::Spec.new do |s|
  s.name = 'IdenzyLynx'
  s.version = package['version']
  s.summary = package['description']
  s.homepage = 'https://github.com/idenzy-io/idenzy'
  s.license = package['license']
  s.authors = 'Idenzy'
  s.source = { :git => 'https://github.com/idenzy-io/idenzy.git', :tag => "v#{s.version}" }
  s.platforms = { :ios => '15.0' }
  s.source_files = '*.{h,m}'
  s.public_header_files = 'IdenzyLynxModule.h'
  s.dependency 'Lynx/Framework'
  s.dependency 'IdenzyBridge'
end
