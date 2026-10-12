Pod::Spec.new do |s|
  s.name = 'Idenzy'
  s.version = '0.1.0'
  s.summary = 'Idenzy for iOS: sign-in, sessions and MFA, with the session in the Keychain.'
  s.homepage = 'https://github.com/idenzy-io/idenzy'
  s.license = { :type => 'MIT' }
  s.authors = 'Idenzy'
  s.source = { :git => 'https://github.com/idenzy-io/idenzy.git', :tag => "v#{s.version}" }
  s.platforms = { :ios => '15.0' }
  s.swift_version = '5.9'
  s.source_files = 'Sources/Idenzy/**/*.swift'
  s.frameworks = 'AuthenticationServices', 'Security'
  s.dependency 'IdenzyCore', s.version.to_s
end
