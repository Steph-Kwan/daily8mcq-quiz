.PHONY: demo web offline test vendor app dmg test-app clean

demo:           ## demo/demo.xlsx, demo/template.xlsx, build/demo.zip
	python3 scripts/build_demo.py

web: demo       ## dist/index.html — the site, and the app's content
	python3 scripts/build_web.py

test: demo      ## Node tests (importer, progress, translations)
	npm test

vendor:         ## Re-bundle src/vendor/ after updating npm dependencies
	npm run vendor

app dmg:        ## build/Daily 8.app and build/Daily-8-<version>.dmg
	./scripts/build_mac.sh

test-app: app   ## Self test inside the real app, with throwaway data
	./scripts/test_mac.sh

clean:
	rm -rf build dist
