Pod::Spec.new do |s|
  s.name = 'IdenzyBridge'
  s.version = '0.1.0'
  s.summary = 'The Idenzy Swift SDK as one method table, for framework plugins rather than apps.'
  s.homepage = 'https://github.com/idenzy-io/idenzy'
  s.license = { :type => 'MIT' }
  s.authors = 'Idenzy'
  s.source = { :git => 'https://github.com/idenzy-io/idenzy.git', :tag => "v#{s.version}" }
  s.platforms = { :ios => '15.0' }
  s.swift_version = '5.9'
  s.source_files = 'Sources/IdenzyBridge/**/*.swift'
  s.dependency 'Idenzy', s.version.to_s
end
